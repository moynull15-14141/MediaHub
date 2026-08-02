import { useEffect, useState } from 'react';
import { Activity, AlertOctagon, ServerCrash, WifiOff, Timer, ListChecks } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { AnalyticsFiltersBar, AnalyticsFilters, filtersToQuery } from './AnalyticsFiltersBar';
import { ExportMenu } from './ExportMenu';
import { LineChart } from './charts/LineChart';

interface ApiAnalytics {
  totalRequests: number; rateLimited429: number; serverError5xx: number; timeoutCount: number; averageResponseTimeMs: number | null;
  dailyUsage: { period: string; count: number }[]; weeklyUsage: { period: string; count: number }[]; monthlyUsage: { period: string; count: number }[];
}

const StatCard = ({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string | number; tone?: string }) => (
  <Card>
    <CardContent className="flex items-center justify-between p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${tone || 'text-[var(--text-primary)]'}`}>{value}</p>
      </div>
      <Icon className="h-7 w-7 text-[var(--text-secondary)]" />
    </CardContent>
  </Card>
);

export function ApiAnalyticsTab({ filters, onFiltersChange }: { filters: AnalyticsFilters; onFiltersChange: (f: AnalyticsFilters) => void }) {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<ApiAnalytics | undefined>(undefined);
  const [granularity, setGranularity] = useState<'dailyUsage' | 'weeklyUsage' | 'monthlyUsage'>('dailyUsage');

  useEffect(() => {
    const query = filtersToQuery(filters);
    whatsappFetch<ApiAnalytics>(token, `/analytics/api${query ? `?${query}` : ''}`)
      .then(setData)
      .catch((err) => push({ title: 'Failed to load API analytics', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AnalyticsFiltersBar filters={filters} onChange={onFiltersChange} />
        <ExportMenu dataset="API" filters={filters} />
      </div>

      {data === undefined ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard icon={ListChecks} label="Total requests" value={data.totalRequests} />
            <StatCard icon={AlertOctagon} label="429 rate limited" value={data.rateLimited429} tone={data.rateLimited429 > 0 ? 'text-amber-400' : undefined} />
            <StatCard icon={ServerCrash} label="5xx server errors" value={data.serverError5xx} tone={data.serverError5xx > 0 ? 'text-rose-400' : undefined} />
            <StatCard icon={WifiOff} label="Timeouts / network" value={data.timeoutCount} tone={data.timeoutCount > 0 ? 'text-rose-400' : undefined} />
            <StatCard icon={Timer} label="Avg response time" value={data.averageResponseTimeMs !== null ? `${data.averageResponseTimeMs}ms` : '—'} />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Meta API usage</CardTitle>
                <div className="flex gap-1 rounded-xl border border-[var(--border)] p-1 text-xs">
                  {(['dailyUsage', 'weeklyUsage', 'monthlyUsage'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGranularity(g)}
                      className={`rounded-lg px-2.5 py-1 font-medium transition ${granularity === g ? 'bg-blue-500/15 text-blue-300' : 'text-[var(--text-secondary)]'}`}
                    >
                      {g === 'dailyUsage' ? 'Daily' : g === 'weeklyUsage' ? 'Weekly' : 'Monthly'}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <LineChart series={[{ name: 'Requests', color: '#3b82f6', points: data[granularity].map((d) => ({ label: d.period, value: d.count })) }]} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
