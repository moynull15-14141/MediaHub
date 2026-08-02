import { useEffect, useState } from 'react';
import { Gauge, Timer, RefreshCw, Layers, Clock, Package, Globe2, CopyCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface QueueSettings {
  defaultCountryCode: string | null;
  autoSkipDuplicates: boolean;
  rateLimitPerMinute: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  maxRetries: number;
  maxConcurrentJobs: number;
  batchSize: number;
  retryDelaySeconds: number;
  sendTimezone: string;
}

const EMPTY: QueueSettings = {
  defaultCountryCode: '', autoSkipDuplicates: true, rateLimitPerMinute: 20, minDelaySeconds: 5,
  maxDelaySeconds: 10, maxRetries: 3, maxConcurrentJobs: 3, batchSize: 1000, retryDelaySeconds: 30, sendTimezone: 'UTC',
};

export function QueueSettingsTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [settings, setSettings] = useState<QueueSettings | undefined>(undefined);
  const [hasAccount, setHasAccount] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    whatsappFetch<QueueSettings | null>(token, '/account')
      .then((account) => {
        if (!account) {
          setHasAccount(false);
          setSettings(EMPTY);
          return;
        }
        setSettings({ ...EMPTY, ...account, defaultCountryCode: account.defaultCountryCode ?? '' });
      })
      .catch((err) => push({ title: 'Failed to load settings', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await whatsappFetch<any>(token, '/account/settings', { method: 'PATCH', body: JSON.stringify(settings) });
      setSettings({ ...EMPTY, ...updated, defaultCountryCode: updated.defaultCountryCode ?? '' });
      push({ title: 'Settings saved', description: 'The worker picks these up on its next tick - no restart needed.' });
    } catch (err: any) {
      push({ title: 'Failed to save settings', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (settings === undefined) return <Skeleton className="h-56 w-full" />;
  if (!hasAccount) return <Card><CardContent className="p-6 text-sm text-[var(--text-muted)]">Connect a WhatsApp account first to configure these settings.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><Gauge className="h-5 w-5" /></div>
            <CardTitle className="text-lg">Sending &amp; queue</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
            <span className="flex items-center gap-2"><Gauge className="h-3.5 w-3.5" /> Messages per minute</span>
            <Input type="number" min={1} max={1000} value={settings.rateLimitPerMinute} onChange={(e) => setSettings({ ...settings, rateLimitPerMinute: Number(e.target.value) })} />
          </label>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
            <span className="flex items-center gap-2"><Layers className="h-3.5 w-3.5" /> Concurrency</span>
            <Input type="number" min={1} max={50} value={settings.maxConcurrentJobs} onChange={(e) => setSettings({ ...settings, maxConcurrentJobs: Number(e.target.value) })} />
          </label>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
            <span className="flex items-center gap-2"><Package className="h-3.5 w-3.5" /> Batch size</span>
            <Input type="number" min={10} max={5000} value={settings.batchSize} onChange={(e) => setSettings({ ...settings, batchSize: Number(e.target.value) })} />
          </label>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
            <span className="flex items-center gap-2"><Timer className="h-3.5 w-3.5" /> Random delay min (sec)</span>
            <Input type="number" min={0} max={3600} value={settings.minDelaySeconds} onChange={(e) => setSettings({ ...settings, minDelaySeconds: Number(e.target.value) })} />
          </label>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
            <span className="flex items-center gap-2"><Timer className="h-3.5 w-3.5" /> Random delay max (sec)</span>
            <Input type="number" min={0} max={3600} value={settings.maxDelaySeconds} onChange={(e) => setSettings({ ...settings, maxDelaySeconds: Number(e.target.value) })} />
          </label>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
            <span className="flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5" /> Retry count</span>
            <Input type="number" min={0} max={10} value={settings.maxRetries} onChange={(e) => setSettings({ ...settings, maxRetries: Number(e.target.value) })} />
          </label>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
            <span className="flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5" /> Retry delay (sec, base)</span>
            <Input type="number" min={1} max={3600} value={settings.retryDelaySeconds} onChange={(e) => setSettings({ ...settings, retryDelaySeconds: Number(e.target.value) })} />
          </label>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
            <span className="flex items-center gap-2"><Clock className="h-3.5 w-3.5" /> Timezone</span>
            <Input value={settings.sendTimezone} onChange={(e) => setSettings({ ...settings, sendTimezone: e.target.value })} placeholder="e.g. Asia/Dhaka" />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><Globe2 className="h-5 w-5" /></div>
            <CardTitle className="text-lg">Import defaults</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <label className="block max-w-xs space-y-2 text-sm text-[var(--text-secondary)]">
            Default country code
            <Input value={settings.defaultCountryCode ?? ''} onChange={(e) => setSettings({ ...settings, defaultCountryCode: e.target.value.toUpperCase() })} placeholder="e.g. BD" maxLength={4} />
          </label>
          <label className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={settings.autoSkipDuplicates} onChange={(e) => setSettings({ ...settings, autoSkipDuplicates: e.target.checked })} className="h-5 w-5 rounded-md border border-[var(--border)] accent-blue-500" />
            <span className="flex items-center gap-2"><CopyCheck className="h-4 w-4" /> Automatically skip duplicate numbers on import</span>
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
      </div>
    </div>
  );
}
