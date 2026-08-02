import { useEffect, useState } from 'react';
import { Bell, Mail, Smartphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface NotificationSettings {
  notifyBrowser: boolean;
  notifyEmail: boolean;
  notifyCampaignCompleted: boolean;
  notifyCampaignFailed: boolean;
  notifyWebhookOffline: boolean;
  notifyQualityDrop: boolean;
  notifyApiFailure: boolean;
}

const EMPTY: NotificationSettings = {
  notifyBrowser: true, notifyEmail: false, notifyCampaignCompleted: true,
  notifyCampaignFailed: true, notifyWebhookOffline: true, notifyQualityDrop: true, notifyApiFailure: true,
};

const EVENTS: { key: keyof NotificationSettings; label: string; description: string }[] = [
  { key: 'notifyCampaignCompleted', label: 'Campaign completed', description: 'A campaign finishes sending to all recipients.' },
  { key: 'notifyCampaignFailed', label: 'Campaign failed', description: 'A campaign is cancelled or stops due to errors.' },
  { key: 'notifyWebhookOffline', label: 'Webhook offline', description: 'No delivery events received for an extended period.' },
  { key: 'notifyQualityDrop', label: 'Quality rating drop', description: 'Your WhatsApp quality rating decreases.' },
  { key: 'notifyApiFailure', label: 'API failure', description: 'Meta API requests start failing repeatedly.' },
];

export function NotificationsTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [settings, setSettings] = useState<NotificationSettings | undefined>(undefined);
  const [hasAccount, setHasAccount] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    whatsappFetch<NotificationSettings | null>(token, '/account')
      .then((account) => {
        if (!account) { setHasAccount(false); setSettings(EMPTY); return; }
        setSettings({ ...EMPTY, ...account });
      })
      .catch((err) => push({ title: 'Failed to load notification settings', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (key: keyof NotificationSettings) => {
    if (!settings) return;
    if (key === 'notifyBrowser' && !settings.notifyBrowser && typeof Notification !== 'undefined') {
      Notification.requestPermission().catch(() => {});
    }
    setSettings({ ...settings, [key]: !settings[key] });
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await whatsappFetch(token, '/account/settings', { method: 'PATCH', body: JSON.stringify(settings) });
      push({ title: 'Notification preferences saved' });
    } catch (err: any) {
      push({ title: 'Failed to save preferences', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (settings === undefined) return <Skeleton className="h-64 w-full" />;
  if (!hasAccount) return <Card><CardContent className="p-6 text-sm text-[var(--text-muted)]">Connect a WhatsApp account first to configure notifications.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><Bell className="h-5 w-5" /></div>
            <CardTitle className="text-lg">Notification channels</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] px-4 py-3">
            <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><Smartphone className="h-4 w-4" /> Browser notifications</span>
            <input type="checkbox" checked={settings.notifyBrowser} onChange={() => toggle('notifyBrowser')} className="h-5 w-5 rounded-md border border-[var(--border)] accent-blue-500" />
          </label>
          <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] px-4 py-3">
            <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><Mail className="h-4 w-4" /> Email notifications</span>
            <input type="checkbox" checked={settings.notifyEmail} onChange={() => toggle('notifyEmail')} className="h-5 w-5 rounded-md border border-[var(--border)] accent-blue-500" />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-lg">Notify me when…</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {EVENTS.map((event) => (
            <label key={event.key} className="flex items-center justify-between rounded-2xl border border-[var(--border)] px-4 py-3">
              <span>
                <span className="block text-sm font-medium text-[var(--text-primary)]">{event.label}</span>
                <span className="block text-xs text-[var(--text-secondary)]">{event.description}</span>
              </span>
              <input type="checkbox" checked={settings[event.key]} onChange={() => toggle(event.key)} className="h-5 w-5 shrink-0 rounded-md border border-[var(--border)] accent-blue-500" />
            </label>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</Button>
      </div>
    </div>
  );
}
