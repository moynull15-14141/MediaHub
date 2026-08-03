import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface DayWindow { enabled: boolean; start: string; end: string; }
type Schedule = Record<string, DayWindow>;

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Monday' }, { key: 'tue', label: 'Tuesday' }, { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' }, { key: 'fri', label: 'Friday' }, { key: 'sat', label: 'Saturday' }, { key: 'sun', label: 'Sunday' },
];

const DEFAULT_WINDOW: DayWindow = { enabled: false, start: '09:00', end: '18:00' };

export function WorkingHoursTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [hasAccount, setHasAccount] = useState(true);

  useEffect(() => {
    whatsappFetch<any>(token, '/account')
      .then((account) => {
        if (!account) { setHasAccount(false); setSchedule(Object.fromEntries(DAYS.map((d) => [d.key, DEFAULT_WINDOW]))); return; }
        setEnabled(account.workingHoursEnabled);
        const existing = (account.workingHours || {}) as Schedule;
        setSchedule(Object.fromEntries(DAYS.map((d) => [d.key, existing[d.key] || DEFAULT_WINDOW])));
      })
      .catch((err) => push({ title: 'Failed to load working hours', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDay = (key: string, patch: Partial<DayWindow>) => {
    setSchedule((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  };

  const handleSave = async () => {
    if (!schedule) return;
    setSaving(true);
    try {
      await whatsappFetch(token, '/account/settings', {
        method: 'PATCH',
        body: JSON.stringify({ workingHoursEnabled: enabled, workingHours: schedule }),
      });
      push({ title: 'Working hours saved', description: 'Campaigns outside these windows will wait automatically.' });
    } catch (err: any) {
      push({ title: 'Failed to save working hours', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (schedule === undefined) return <Skeleton className="h-72 w-full" />;
  if (!hasAccount) return <Card><CardContent className="p-6 text-sm text-[var(--text-muted)]">Connect a WhatsApp account first to configure working hours.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><CalendarClock className="h-5 w-5" /></div>
              <CardTitle className="text-lg">Business hours</CardTitle>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 rounded-md border border-[var(--border)] accent-[var(--accent)]" />
              Enforce working hours
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {DAYS.map((day) => {
            const window = schedule[day.key];
            return (
              // Mobile (below sm:): 2 stacked rows (day+toggle, then both time
              // pickers side by side) - the old single-row 4-column grid put
              // native <input type="time"> (which has a non-shrinkable
              // intrinsic width) into `auto` tracks, forcing horizontal
              // scroll on 320-375px screens. From sm: up, `sm:contents` on
              // the two wrapper divs makes them disappear from layout so
              // their 4 children resume acting as direct grid items in the
              // original [140px_auto_1fr_1fr] row, unchanged from before.
              <div key={day.key} className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] px-4 py-3 sm:grid sm:grid-cols-[140px_auto_1fr_1fr] sm:items-center sm:gap-3">
                <div className="flex items-center justify-between sm:contents">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{day.label}</span>
                  <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <input type="checkbox" checked={window.enabled} onChange={(e) => updateDay(day.key, { enabled: e.target.checked })} className="h-4 w-4 rounded border border-[var(--border)] accent-[var(--accent)]" />
                    Enabled
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:contents">
                  <input
                    type="time"
                    value={window.start}
                    disabled={!window.enabled}
                    onChange={(e) => updateDay(day.key, { start: e.target.value })}
                    className="input-field w-full rounded-xl px-3 py-2 text-sm disabled:opacity-50"
                  />
                  <input
                    type="time"
                    value={window.end}
                    disabled={!window.enabled}
                    onChange={(e) => updateDay(day.key, { end: e.target.value })}
                    className="input-field w-full rounded-xl px-3 py-2 text-sm disabled:opacity-50"
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save working hours'}</Button>
      </div>
    </div>
  );
}
