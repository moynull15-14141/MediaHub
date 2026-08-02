import { useEffect, useState } from 'react';
import { Webhook, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface WebhookMonitor {
  connected: boolean;
  webhookVerified: boolean;
  webhookLastPingAt: string | null;
  webhookLastDeliveryAt: string | null;
  webhookLastReadAt: string | null;
  webhookLastErrorAt: string | null;
  webhookLastErrorMessage: string | null;
}

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-[var(--border)] px-4 py-3">
    <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--text-secondary)]"><Clock className="h-3.5 w-3.5" /> {label}</p>
    <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{value}</p>
  </div>
);

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : 'Never');

export function WebhookMonitorTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<WebhookMonitor | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const result = await whatsappFetch<WebhookMonitor>(token, '/account/webhook-monitor');
      setData(result);
    } catch (err: any) {
      push({ title: 'Failed to load webhook status', description: err.message });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () => { setRefreshing(true); load(); };

  if (data === undefined) return <Skeleton className="h-64 w-full" />;
  if (!data.connected) return <Card><CardContent className="p-6 text-sm text-[var(--text-muted)]">Connect a WhatsApp account first to monitor its webhook.</CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><Webhook className="h-5 w-5" /></div>
            <CardTitle className="text-lg">Webhook monitor</CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Badge variant={data.webhookVerified ? 'success' : 'danger'}>
          {data.webhookVerified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {data.webhookVerified ? 'Verified & receiving events' : 'Not verified'}
        </Badge>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Last ping" value={fmt(data.webhookLastPingAt)} />
          <Field label="Last delivery event" value={fmt(data.webhookLastDeliveryAt)} />
          <Field label="Last read receipt" value={fmt(data.webhookLastReadAt)} />
          <Field label="Last error" value={fmt(data.webhookLastErrorAt)} />
        </div>

        {data.webhookLastErrorMessage && (
          <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{data.webhookLastErrorMessage}</div>
        )}
      </CardContent>
    </Card>
  );
}
