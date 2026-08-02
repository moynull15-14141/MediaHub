import { useEffect, useState } from 'react';
import { Webhook, CheckCheck, Eye, AlertTriangle, ShieldCheck, Timer, Clock3 } from 'lucide-react';
import { Card, CardContent } from '@/src/components/ui/card';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { ExportMenu } from './ExportMenu';
import { EMPTY_FILTERS } from './AnalyticsFiltersBar';
import { formatDuration } from './formatters';

interface WebhookAnalytics {
  receivedEvents: number; delivered: number; read: number; failed: number;
  verified: boolean; connected: boolean; webhookDelayMs: number | null; lastEvent: string | null; lastErrorMessage: string | null;
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

export function WebhookAnalyticsTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<WebhookAnalytics | undefined>(undefined);

  useEffect(() => {
    whatsappFetch<WebhookAnalytics>(token, '/analytics/webhook')
      .then(setData)
      .catch((err) => push({ title: 'Failed to load webhook analytics', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <ExportMenu dataset="WEBHOOK" filters={EMPTY_FILTERS} />
      </div>

      {data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : !data.connected ? (
        <Card><CardContent className="p-6 text-sm text-[var(--text-muted)]">Connect a WhatsApp account first to see webhook analytics.</CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.verified ? 'success' : 'outline'}><ShieldCheck className="h-3.5 w-3.5" /> {data.verified ? 'Verified' : 'Not verified'}</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Webhook} label="Received events" value={data.receivedEvents} />
            <StatCard icon={CheckCheck} label="Delivered" value={data.delivered} tone="text-emerald-400" />
            <StatCard icon={Eye} label="Read" value={data.read} tone="text-blue-400" />
            <StatCard icon={AlertTriangle} label="Failed" value={data.failed} tone="text-rose-400" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard icon={Timer} label="Webhook delay (avg)" value={formatDuration(data.webhookDelayMs)} />
            <StatCard icon={Clock3} label="Last event" value={data.lastEvent ? new Date(data.lastEvent).toLocaleString() : 'Never'} />
          </div>
          {data.lastErrorMessage && (
            <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{data.lastErrorMessage}</div>
          )}
        </>
      )}
    </div>
  );
}
