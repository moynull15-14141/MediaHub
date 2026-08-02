import { useEffect, useState } from 'react';
import { Layers, Clock3, PlayCircle, CheckCircle2, RefreshCw, Skull, Timer, Gauge } from 'lucide-react';
import { Card, CardContent } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { ExportMenu } from './ExportMenu';
import { EMPTY_FILTERS } from './AnalyticsFiltersBar';
import { formatDuration } from './formatters';

interface QueueAnalytics {
  currentQueueSize: number; waiting: number; running: number; completed: number; retrying: number; dead: number;
  avgWaitTimeMs: number | null; avgProcessingTimeMs: number | null; workerUtilizationPercent: number; maxConcurrentJobs: number;
  workerHeartbeat: { running: boolean; lastTickAt: string | null };
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

// Live snapshot - no date filters (matches the backend's "Live" scoping
// decision), auto-refreshes every 10s so the numbers track the worker in
// real time without the user needing to reload.
export function QueueAnalyticsTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<QueueAnalytics | undefined>(undefined);

  const load = () => {
    whatsappFetch<QueueAnalytics>(token, '/analytics/queue')
      .then(setData)
      .catch((err) => push({ title: 'Failed to load queue analytics', description: err.message }));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">Auto-refreshes every 10 seconds.</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh</Button>
          <ExportMenu dataset="QUEUE" filters={EMPTY_FILTERS} />
        </div>
      </div>

      {data === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i}><Skeleton className="h-24 w-full" /></div>)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard icon={Layers} label="Current queue size" value={data.currentQueueSize} />
            <StatCard icon={Clock3} label="Waiting" value={data.waiting} />
            <StatCard icon={PlayCircle} label="Running" value={data.running} tone="text-blue-400" />
            <StatCard icon={CheckCircle2} label="Completed" value={data.completed} tone="text-emerald-400" />
            <StatCard icon={RefreshCw} label="Retrying" value={data.retrying} tone="text-amber-400" />
            <StatCard icon={Skull} label="Dead jobs" value={data.dead} tone="text-rose-400" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard icon={Timer} label="Avg wait time" value={formatDuration(data.avgWaitTimeMs)} />
            <StatCard icon={Timer} label="Avg processing time" value={formatDuration(data.avgProcessingTimeMs)} />
            <StatCard icon={Gauge} label="Worker utilization" value={`${data.workerUtilizationPercent}% (${data.maxConcurrentJobs} max)`} />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Worker: {data.workerHeartbeat.running ? 'running' : 'stopped'}
            {data.workerHeartbeat.lastTickAt ? ` · last tick ${new Date(data.workerHeartbeat.lastTickAt).toLocaleTimeString()}` : ''}
          </p>
        </>
      )}
    </div>
  );
}
