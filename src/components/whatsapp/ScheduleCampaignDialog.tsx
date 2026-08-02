import { useEffect, useState } from 'react';
import { Send, CalendarClock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface ScheduleCampaignDialogProps {
  open: boolean;
  campaignId: string | null;
  campaignName?: string;
  onClose: () => void;
  onDone: () => void;
}

const detectedTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

// Formats "now + 1h" as a value suitable for <input type="datetime-local">.
const defaultScheduleValue = (): string => {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

export function ScheduleCampaignDialog({ open, campaignId, campaignName, onClose, onDone }: ScheduleCampaignDialogProps) {
  const { token } = useAuth();
  const { push } = useToast();

  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleValue());
  const [timezone, setTimezone] = useState(detectedTimezone());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('now');
    setScheduledAt(defaultScheduleValue());
    setTimezone(detectedTimezone());
  }, [open]);

  const handleSubmit = async () => {
    if (!campaignId) return;
    setSubmitting(true);
    try {
      if (mode === 'now') {
        await whatsappFetch(token, `/campaigns/${campaignId}/send`, { method: 'POST' });
        push({ title: 'Campaign is sending', description: campaignName });
      } else {
        const iso = new Date(scheduledAt).toISOString();
        await whatsappFetch(token, `/campaigns/${campaignId}/schedule`, {
          method: 'POST',
          body: JSON.stringify({ scheduledAt: iso, timezone }),
        });
        push({ title: 'Campaign scheduled', description: campaignName });
      }
      onDone();
      onClose();
    } catch (err: any) {
      push({ title: 'Failed to start campaign', description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send "{campaignName}"</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('now')}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${mode === 'now' ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--panel-bg)]'}`}
            >
              <Send className="h-4 w-4" /> Send now
            </button>
            <button
              type="button"
              onClick={() => setMode('later')}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${mode === 'later' ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--panel-bg)]'}`}
            >
              <CalendarClock className="h-4 w-4" /> Schedule later
            </button>
          </div>

          {mode === 'later' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Date &amp; time
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Timezone
                <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. Asia/Dhaka" required />
              </label>
            </div>
          )}

          <p className="text-xs text-[var(--text-muted)]">
            {mode === 'now'
              ? 'Messages will start sending immediately, respecting your account’s rate limit and delay settings.'
              : 'The worker automatically starts this campaign once the scheduled time arrives.'}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Starting…' : mode === 'now' ? 'Send now' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
