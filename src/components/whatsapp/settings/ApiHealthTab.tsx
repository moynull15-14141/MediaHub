import { useEffect, useState } from 'react';
import { Activity, RefreshCw, TrendingUp, AlertOctagon, ServerCrash, Timer, ListChecks } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface ApiHealth {
  totalRequestsToday: number;
  successPercent: number;
  rateLimitedCount: number;
  serverErrorCount: number;
  averageResponseTimeMs: number | null;
  lastFailure: { createdAt: string; errorCode: string | null; errorMessage: string | null } | null;
}

const StatCard = ({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: 'danger' | 'warning' }) => (
  <div className="rounded-2xl border border-[var(--border)] px-4 py-4">
    <div className={`flex items-center gap-2 text-xs uppercase tracking-wide ${tone === 'danger' ? 'text-rose-300' : tone === 'warning' ? 'text-amber-300' : 'text-[var(--text-secondary)]'}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </div>
    <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{value}</p>
  </div>
);

export function ApiHealthTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<ApiHealth | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const result = await whatsappFetch<ApiHealth>(token, '/account/api-health');
      setData(result);
    } catch (err: any) {
      push({ title: 'Failed to load API health', description: err.message });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () => { setRefreshing(true); load(); };

  if (data === undefined) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><Activity className="h-5 w-5" /></div>
            <CardTitle className="text-lg">Meta API health (today)</CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard icon={ListChecks} label="Total requests" value={String(data.totalRequestsToday)} />
          <StatCard icon={TrendingUp} label="Success rate" value={`${data.successPercent.toFixed(1)}%`} />
          <StatCard icon={Timer} label="Avg response time" value={data.averageResponseTimeMs != null ? `${data.averageResponseTimeMs} ms` : '—'} />
          <StatCard icon={AlertOctagon} label="429 rate limited" value={String(data.rateLimitedCount)} tone={data.rateLimitedCount > 0 ? 'warning' : undefined} />
          <StatCard icon={ServerCrash} label="5xx server errors" value={String(data.serverErrorCount)} tone={data.serverErrorCount > 0 ? 'danger' : undefined} />
        </div>

        <div className="rounded-2xl border border-[var(--border)] px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Last failure</p>
          <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">
            {data.lastFailure ? `${new Date(data.lastFailure.createdAt).toLocaleString()} — ${data.lastFailure.errorMessage || data.lastFailure.errorCode || 'Unknown error'}` : 'No failures today'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
