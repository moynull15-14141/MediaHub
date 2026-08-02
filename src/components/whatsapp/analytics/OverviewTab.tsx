import { useEffect, useState } from 'react';
import {
  Megaphone, PlayCircle, CalendarClock, CheckCircle2, PauseCircle, XCircle,
  CheckCheck, Eye, AlertTriangle, Clock3, RefreshCw, Gauge, Timer,
} from 'lucide-react';
import { Card, CardContent } from '@/src/components/ui/card';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { AnalyticsFiltersBar, AnalyticsFilters, filtersToQuery } from './AnalyticsFiltersBar';
import { ExportMenu } from './ExportMenu';
import { TrendChartCard } from './TrendChartCard';
import { formatDuration } from './formatters';

interface Overview {
  totalCampaigns: number; running: number; scheduled: number; completed: number; paused: number; cancelled: number;
  delivered: number; read: number; failed: number; pending: number; retrying: number;
  successRate: number; readRate: number; deliveryRate: number;
  avgDeliveryTimeMs: number | null; avgReadTimeMs: number | null; avgQueueTimeMs: number | null;
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

export function OverviewTab({ filters, onFiltersChange }: { filters: AnalyticsFilters; onFiltersChange: (f: AnalyticsFilters) => void }) {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<Overview | undefined>(undefined);

  useEffect(() => {
    const query = filtersToQuery(filters);
    whatsappFetch<Overview>(token, `/analytics/overview${query ? `?${query}` : ''}`)
      .then(setData)
      .catch((err) => push({ title: 'Failed to load overview', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AnalyticsFiltersBar filters={filters} onChange={onFiltersChange} showStatus showGroupLabel showSearch />
        <ExportMenu dataset="OVERVIEW" filters={filters} />
      </div>

      {data === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i}><Skeleton className="h-24 w-full" /></div>)}
        </div>
      ) : (
        <>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Campaigns</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard icon={Megaphone} label="Total" value={data.totalCampaigns} />
              <StatCard icon={PlayCircle} label="Running" value={data.running} tone="text-blue-400" />
              <StatCard icon={CalendarClock} label="Scheduled" value={data.scheduled} tone="text-amber-400" />
              <StatCard icon={CheckCircle2} label="Completed" value={data.completed} tone="text-emerald-400" />
              <StatCard icon={PauseCircle} label="Paused" value={data.paused} />
              <StatCard icon={XCircle} label="Cancelled" value={data.cancelled} tone="text-rose-400" />
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Messages</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <StatCard icon={CheckCheck} label="Delivered" value={data.delivered} tone="text-emerald-400" />
              <StatCard icon={Eye} label="Read" value={data.read} tone="text-blue-400" />
              <StatCard icon={AlertTriangle} label="Failed" value={data.failed} tone="text-rose-400" />
              <StatCard icon={Clock3} label="Pending" value={data.pending} />
              <StatCard icon={RefreshCw} label="Retrying" value={data.retrying} tone="text-amber-400" />
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Rates &amp; timing</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard icon={Gauge} label="Success rate" value={`${data.successRate}%`} />
              <StatCard icon={Gauge} label="Read rate" value={`${data.readRate}%`} />
              <StatCard icon={Gauge} label="Delivery rate" value={`${data.deliveryRate}%`} />
              <StatCard icon={Timer} label="Avg delivery time" value={formatDuration(data.avgDeliveryTimeMs)} />
              <StatCard icon={Timer} label="Avg read time" value={formatDuration(data.avgReadTimeMs)} />
              <StatCard icon={Timer} label="Avg queue time" value={formatDuration(data.avgQueueTimeMs)} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TrendChartCard title="Campaign trend" metric="campaignTrend" filters={filters} color="#3b82f6" />
            <TrendChartCard title="Delivery trend" metric="deliveryTrend" filters={filters} color="#10b981" />
          </div>
        </>
      )}
    </div>
  );
}
